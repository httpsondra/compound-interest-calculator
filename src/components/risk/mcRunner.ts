import type { MonteCarloInput, MonteCarloResult } from '../../engine/montecarlo'

/*
 * Lifecycle of Monte Carlo requests (pure; no DOM globals, so it is unit-tested directly).
 *
 * • Every request has an ID. Only the newest request may deliver a result; older ones are dropped.
 * • The worker is used while it works. If it fails to start, crashes, or cannot deserialise a
 *   message, the CURRENT request is recomputed on the main thread exactly once, and later requests
 *   run there too (the worker is not restarted).
 * • Error events are idempotent: repeated worker errors can never start a second fallback.
 * • dispose() terminates the worker and cancels whatever is pending (unmount).
 */

export interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((e: { data: { id: number; result: MonteCarloResult } }) => void) | null
  onerror: ((e: { preventDefault?: () => void }) => void) | null
  onmessageerror: (() => void) | null
}

interface Request {
  id: number
  input: MonteCarloInput
  settled: boolean
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
  ) {}

  /** Start a request. Any earlier unfinished request is cancelled. Returns its ID. */
  request(input: MonteCarloInput, deliver: (r: MonteCarloResult) => void): number {
    if (this.current) this.current.settled = true
    const id = ++this.nextId
    const req: Request = { id, input, settled: false, deliver }
    this.current = req
    if (!this.worker && !this.failed && this.create) this.start()
    if (this.worker) {
      try {
        this.worker.postMessage({ id, input })
      } catch {
        this.fail()
      }
    } else this.settle(req, () => this.compute(input))
    return id
  }

  /** Cancel everything and release the worker (component unmount). */
  dispose(): void {
    if (this.current) this.current.settled = true
    this.current = null
    this.worker?.terminate()
    this.worker = null
  }

  /** For tests and diagnostics. */
  get usesFallback(): boolean {
    return this.failed || !this.create
  }

  private start(): void {
    try {
      const w = this.create!()
      w.onmessage = (e) => {
        const req = this.current
        if (req && !req.settled && e.data.id === req.id) this.settle(req, () => e.data.result)
      }
      w.onerror = (ev) => {
        ev?.preventDefault?.()
        this.fail()
      }
      w.onmessageerror = () => this.fail()
      this.worker = w
    } catch {
      this.fail()
    }
  }

  /** Worker unusable: stop it once and recompute the pending request once on this thread. */
  private fail(): void {
    if (this.failed) return
    this.failed = true
    this.worker?.terminate()
    this.worker = null
    const req = this.current
    if (req) this.settle(req, () => this.compute(req.input))
  }

  private settle(req: Request, produce: () => MonteCarloResult): void {
    if (req.settled) return
    req.settled = true
    req.deliver(produce())
  }
}
