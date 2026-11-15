import type { MonteCarloInput, MonteCarloResult } from '../../engine/montecarlo'

/*
 * Lifecycle of Monte Carlo requests (pure; no DOM globals, so it is unit-tested directly).
 *
 * • Every request has an ID. Only the newest request may deliver a result; older ones are dropped.
 * • Watchdog: a worker that does not answer within WATCHDOG_MS is unresponsive. It is discarded (its
 *   late answers are ignored), the request is computed on the main thread once, and later requests run
 *   there too: a worker that hung once is not trusted again, so the page never waits on a second hang.
 * • Crash or message error: handled the same way, once.
 * • A newer request stops the superseded job (its worker is terminated), so the watchdog only ever
 *   times the job it is waiting for, never time spent queued behind obsolete work.
 * • A request is settled exactly once. Error events, messages and timers cannot start a second
 *   computation for the same request.
 * • dispose() cancels pending work and terminates the worker (component unmount).
 */

export const WATCHDOG_MS = 15_000

export interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((e: { data: { id: number; result: MonteCarloResult } }) => void) | null
  onerror: ((e: { preventDefault?: () => void }) => void) | null
  onmessageerror: (() => void) | null
}

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set: (fn, ms) => globalThis.setTimeout(fn, ms),
  clear: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
}

interface Request {
  id: number
  input: MonteCarloInput
  settled: boolean
  timer: unknown
  deliver: (r: MonteCarloResult) => void
}

export class McRunner {
  private worker: WorkerLike | null = null
  private failed = false
  private current: Request | null = null
  private nextId = 0

  constructor(
    private readonly create: (() => WorkerLike) | null,
    private readonly compute: (input: MonteCarloInput) => MonteCarloResult,
    private readonly watchdogMs = WATCHDOG_MS,
    private readonly timers: Timers = realTimers,
  ) {}

  /** Start a request. Any earlier unfinished request is cancelled. Returns its ID. */
  request(input: MonteCarloInput, deliver: (r: MonteCarloResult) => void): number {
    this.cancelCurrent()
    // The superseded job is stopped, not queued behind: the worker starts fresh for this request.
    this.discardWorker()
    const id = ++this.nextId
    const req: Request = { id, input, settled: false, timer: null, deliver }
    this.current = req
    this.send(req)
    return id
  }

  /** Cancel everything and release the worker (component unmount). */
  dispose(): void {
    this.cancelCurrent()
    this.current = null
    this.discardWorker()
  }

  /** True when requests run on the main thread (no worker, or the worker failed). */
  get usesFallback(): boolean {
    return this.failed || !this.create
  }

  private cancelCurrent(): void {
    const req = this.current
    if (!req) return
    req.settled = true
    this.disarm(req)
  }

  private send(req: Request): void {
    if (!this.worker && !this.failed && this.create) this.start()
    if (!this.worker) {
      this.settle(req, () => this.compute(req.input))
      return
    }
    try {
      this.worker.postMessage({ id: req.id, input: req.input })
    } catch {
      this.fail(req)
      return
    }
    this.arm(req)
  }

  private start(): void {
    try {
      const w = this.create!()
      w.onmessage = (e) => {
        if (this.worker !== w) return // a discarded worker: its answer is stale
        const req = this.current
        if (req && !req.settled && e.data.id === req.id) {
          this.disarm(req)
          this.settle(req, () => e.data.result)
        }
      }
      w.onerror = (ev) => {
        ev?.preventDefault?.()
        if (this.worker === w) this.fail(this.current)
      }
      w.onmessageerror = () => {
        if (this.worker === w) this.fail(this.current)
      }
      this.worker = w
    } catch {
      this.fail(this.current)
    }
  }

  private arm(req: Request): void {
    this.disarm(req)
    req.timer = this.timers.set(() => this.timeout(req), this.watchdogMs)
  }

  private disarm(req: Request): void {
    if (req.timer != null) this.timers.clear(req.timer)
    req.timer = null
  }

  /** The worker did not answer in time: discard it, stop trusting workers, and compute this request here once. */
  private timeout(req: Request): void {
    req.timer = null
    if (req.settled || this.current !== req) return
    this.discardWorker()
    this.failed = true
    this.settle(req, () => this.compute(req.input))
  }

  /** Worker crashed or cannot deserialise: the pending request is computed here once, and the worker is not restarted. */
  private fail(req: Request | null): void {
    if (this.failed) return
    this.failed = true
    this.discardWorker()
    if (req && !req.settled) {
      this.disarm(req)
      this.settle(req, () => this.compute(req.input))
    }
  }

  private discardWorker(): void {
    this.worker?.terminate()
    this.worker = null
  }

  private settle(req: Request, produce: () => MonteCarloResult): void {
    if (req.settled) return
    req.settled = true
    this.disarm(req)
    req.deliver(produce())
  }
}
