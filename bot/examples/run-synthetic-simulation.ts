import { runSimulation } from '../sim/run-simulation'

console.log(JSON.stringify({ source: 'synthetic', ...runSimulation() }, null, 2))
