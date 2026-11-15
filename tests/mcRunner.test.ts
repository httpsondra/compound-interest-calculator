import { describe, expect, it, vi } from 'vitest'
import type { MonteCarloInput, MonteCarloResult } from '../src/engine/montecarlo'
import { McRunner, type WorkerLike } from '../src/components/risk/mcRunner'

const input = (seed: number): MonteCarloInput => ({ plan: {} as never, volatility: 0.1, simulations: 10, seed, goal: null, income: null })
const result = (tag: number) => ({ tag }) as unknown as MonteCarloResult

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

function setup(createThrows = false) {
  const workers: FakeWorker[] = []
  const compute = vi.fn((i: MonteCarloInput) => result(i.seed))
  const create = () => {
    if (createThrows) throw new Error('blocked')
    const w = new FakeWorker()
    workers.push(w)
    return w
  }
  const runner = new McRunner(create, compute)
  return { runner, workers, compute }
}

describe('Monte Carlo runner lifecycle', () => {
  it('worker answers normally; each request gets its own result', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    const id = runner.request(input(1), (r) => got.push((r as unknown as { tag: number }).tag))
    workers[0].reply(id, result(1))
    expect(got).toEqual([1])
    expect(compute).not.toHaveBeenCalled()
  })

  it('failure before initialisation: computed once on the main thread', () => {
    const { runner, compute } = setup(true)
    const got: number[] = []
    runner.request(input(7), (r) => got.push((r as unknown as { tag: number }).tag))
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([7])
    expect(runner.usesFallback).toBe(true)
  })

  it('worker crashes during a simulation: the pending request falls back exactly once', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    runner.request(input(3), (r) => got.push((r as unknown as { tag: number }).tag))
    workers[0].crash()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([3])
    expect(workers[0].terminated).toBe(1)
  })

  it('repeated worker error events never start a second fallback', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    runner.request(input(4), (r) => got.push((r as unknown as { tag: number }).tag))
    workers[0].crash()
    workers[0].crash()
    workers[0].onmessageerror?.()
    workers[0].crash()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([4])
    expect(workers[0].terminated).toBe(1)
  })

  it('a message-deserialisation error also falls back once', () => {
    const { runner, workers, compute } = setup()
    const got: number[] = []
    runner.request(input(5), (r) => got.push((r as unknown as { tag: number }).tag))
    workers[0].onmessageerror?.()
    workers[0].crash()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(got).toEqual([5])
  })

  it('stale results never overwrite newer ones (rapid parameter changes)', () => {
    const { runner, workers } = setup()
    const got: number[] = []
    const ids = [1, 2, 3, 4].map((s) => runner.request(input(s), (r) => got.push((r as unknown as { tag: number }).tag)))
    // Answers arrive out of order and late.
    workers[0].reply(ids[1], result(2))
    workers[0].reply(ids[0], result(1))
    workers[0].reply(ids[2], result(3))
    expect(got).toEqual([])
    workers[0].reply(ids[3], result(4))
    expect(got).toEqual([4])
  })

  it('cancellation during fallback: dispose before the crash computes nothing and delivers nothing', () => {
    const { runner, workers, compute } = setup()
    const deliver = vi.fn()
    runner.request(input(9), deliver)
    runner.dispose()
    workers[0].crash()
    expect(compute).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
    expect(workers[0].terminated).toBeGreaterThanOrEqual(1)
  })

  it('requests after a failed worker keep working on the main thread, without restarting the worker', () => {
    const { runner, workers, compute } = setup()
    runner.request(input(1), () => {})
    workers[0].crash()
    const got: number[] = []
    runner.request(input(2), (r) => got.push((r as unknown as { tag: number }).tag))
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
