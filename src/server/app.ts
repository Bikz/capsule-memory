import { startApp } from 'modelence/server';

import memoryModule from './memory';
import connectorsModule from './connectors';

startApp({
  modules: [memoryModule, connectorsModule]
});
