import { describe, expect, it, vi } from 'vitest'
import type { MonteCarloInput, MonteCarloResult } from '../src/engine/montecarlo'
import { McRunner, type WorkerLike } from '../src/components/risk/mcRunner'

const input = (seed: number): MonteCarloInput => ({ plan: {} as never, volatility: 0.1, simulations: 10, seed, goal: null, income: null })
const result = (tag: number) => ({ tag }) as unknown as MonteCarloResult
const tagOf = (r: MonteCarloResult) => (r as unknown as { tag: number }).tag

class FakeWorker implements WorkerLike {
  posted: Array<{ id: number; input: MonteCarloInput }> = []
  terminated = 0
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  onmessageerror: WorkerLike['onmessageerror'] = null
  postMessage(m: unknown) {
    this.posted.push(m as { id: number; input: MonteCarloInput })
  }
  terminate() {
    this.terminated++
  }
  reply(id: number, r: MonteCarloResult) {
    this.onmessage?.({ data: { id, result: r } })
  }
  crash() {
    this.onerror?.({ preventDefault: () => {} })
  }
}

/** A clock the test controls: armed timers fire only when `fire()` is called. */
class ManualTimers {
  private next = 1
  private live = new Map<number, () => void>()
  set = (fn: () => void) => {
    const id = this.next++
    this.live.set(id, fn)
    return id
  }
  clear = (h: unknown) => {
    this.live.delete(h as number)
  }
  get pending() {
    return this.live.size
  }
  fire() {
    const fns = [...this.live.values()]
    this.live.clear()
    fns.forEach((f) => f())
  }
}

function setup(opts: { createThrows?: boolean; withTimers?: boolean } = {}) {
  const timers = new ManualTimers()
  const workers: FakeWorker[] = []
  const compute = vi.fn((i: MonteCarloInput) => result(i.seed))
  const create = () => {
    if (opts.createThrows) throw new Error('blocked')
    const w = new FakeWorker()
    workers.push(w)
    return w
  }
  const runner = new McRunner(create, compute, 15_000, timers)
  return { runner, workers, compute, timers }
}

describe('Monte Carlo runner: results and failures', () => {
  it('worker answers normally; each request gets its own result', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    const id = runner.request(input(1), (r) => got.push(tagOf(r)))
    workers[0].reply(id, result(1))
    expect(got).toEqual([1])
    expect(compute).not.toHaveBeenCalled()
  })

  it('failure before initialisation: computed once on the main thread', () => {
    const { runner, compute } = setup({ createThrows: true })
    const got: number[] = []
    runner.request(input(7), (r) => got.push(tagOf(r)))
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([7])
    expect(runner.usesFallback).toBe(true)
  })

  it('worker crashes during a simulation: the pending request is computed once, here', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    runner.request(input(3), (r) => got.push(tagOf(r)))
    workers[0].crash()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([3])
    expect(workers[0].terminated).toBe(1)
  })

  it('repeated worker error events never start a second computation', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    runner.request(input(4), (r) => got.push(tagOf(r)))
    workers[0].crash()
    workers[0].crash()
    workers[0].onmessageerror?.()
    workers[0].crash()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([4])
  })

  it('a message-deserialisation error also falls back once', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    runner.request(input(5), (r) => got.push(tagOf(r)))
    workers[0].onmessageerror?.()
    workers[0].crash()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([5])
  })

  it('stale results never overwrite newer ones (rapid parameter changes)', () => {
    const { runner, workers } = setup()
    const got: number[] = []
    const ids = [1, 2, 3, 4].map((s) => runner.request(input(s), (r) => got.push(tagOf(r))))
    // Each newer request replaced the worker, so only the newest worker's answer can arrive.
    expect(workers[0].terminated).toBe(1)
    workers[0].reply(ids[0], result(1))
    workers[1].reply(ids[1], result(2))
    workers[2].reply(ids[2], result(3))
    expect(got).toEqual([])
    workers[3].reply(ids[3], result(4))
    expect(got).toEqual([4])
  })

  it('cancellation during a fallback: dispose before the crash computes and delivers nothing', () => {
    const { runner, workers, compute } = setup()
    const deliver = vi.fn()
    runner.request(input(9), deliver)
    runner.dispose()
    workers[0].crash()
    expect(compute).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
    expect(workers[0].terminated).toBeGreaterThanOrEqual(1)
  })

  it('after a crash, later requests keep working on the main thread without restarting the worker', () => {
    const { runner, workers, compute } = setup()
    runner.request(input(1), () => {})
    workers[0].crash()
    const got: number[] = []
    runner.request(input(2), (r) => got.push(tagOf(r)))
    expect(got).toEqual([2])
    expect(workers).toHaveLength(1)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('the fallback result equals a direct computation (numerically correct)', () => {
    const real = (i: MonteCarloInput) => ({ sum: i.seed * 2 }) as unknown as MonteCarloResult
    const runner = new McRunner(null, real)
    let out: unknown = null
    runner.request(input(21), (r) => (out = r))
    expect(out).toEqual(real(input(21)))
  })
})

describe('Monte Carlo watchdog', () => {
  it('an unresponsive worker is discarded and the request computed here once', () => {
    const { runner, workers, compute, timers } = setup()
    const got: number[] = []
    runner.request(input(1), (r) => got.push(tagOf(r)))
    timers.fire()
    expect(workers[0].terminated).toBe(1)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([1])
    expect(runner.usesFallback).toBe(true)
    expect(timers.pending).toBe(0)
  })

  it('a later request after a hang does not spawn another worker or wait for one', () => {
    const { runner, workers, compute, timers } = setup()
    const got: number[] = []
    runner.request(input(1), (r) => got.push(tagOf(r)))
    timers.fire()
    runner.request(input(2), (r) => got.push(tagOf(r)))
    expect(workers).toHaveLength(1)
    expect(compute).toHaveBeenCalledTimes(2)
    expect(got).toEqual([1, 2])
    expect(timers.pending).toBe(0)
  })

  it('the watchdog times only the job it waits for: a superseded worker is stopped, not queued behind', () => {
    const { runner, workers, timers } = setup()
    const got: number[] = []
    runner.request(input(7), (r) => got.push(tagOf(r)))
    const newer = runner.request(input(8), (r) => got.push(tagOf(r)))
    expect(workers[0].terminated).toBe(1)
    expect(workers).toHaveLength(2)
    workers[1].reply(newer, result(8))
    expect(got).toEqual([8])
    expect(timers.pending).toBe(0)
  })

  it('the fallback after a hang runs exactly once; nothing from the hung worker adds a delivery', () => {
    const { runner, workers, compute, timers } = setup()
    const got: number[] = []
    const id = runner.request(input(2), (r) => got.push(tagOf(r)))
    timers.fire()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([2])
    workers[0].reply(id, result(99))
    expect(got).toEqual([2])
  })

  it('a late answer from a discarded worker is ignored', () => {
    const { runner, workers, timers } = setup()
    const got: number[] = []
    const id = runner.request(input(3), (r) => got.push(tagOf(r)))
    timers.fire()
    workers[0].reply(id, result(777))
    expect(got).toEqual([3])
  })

  it('dispose during the watchdog cancels everything: no computation, no delivery, no timers', () => {
    const { runner, workers, compute, timers } = setup()
    const deliver = vi.fn()
    runner.request(input(6), deliver)
    runner.dispose()
    expect(timers.pending).toBe(0)
    timers.fire()
    expect(workers).toHaveLength(1)
    expect(compute).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('no request is ever delivered or computed more than once, whatever the sequence of events', () => {
    const { runner, workers, compute, timers } = setup()
    const deliveries: Record<number, number> = {}
    for (let s = 10; s < 16; s++) {
      runner.request(input(s), () => (deliveries[s] = (deliveries[s] ?? 0) + 1))
      if (s % 2) timers.fire()
      if (s % 3 === 0) workers[workers.length - 1].crash()
    }
    timers.fire()
    timers.fire()
    for (const k of Object.keys(deliveries)) expect(deliveries[Number(k)]).toBe(1)
    expect(compute.mock.calls.length).toBeLessThanOrEqual(Object.keys(deliveries).length)
  })
})
