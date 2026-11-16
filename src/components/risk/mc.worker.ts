import { runMonteCarlo, type MonteCarloInput } from '../../engine/montecarlo'

self.onmessage = (e: MessageEvent<{ id: number; input: MonteCarloInput }>) => {
  const { id, input } = e.data
  const result = runMonteCarlo(input)
  ;(self as unknown as Worker).postMessage({ id, result })
}
