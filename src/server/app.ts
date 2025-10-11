import { startApp } from 'modelence/server';

import memoryModule from './memory';

startApp({
  modules: [memoryModule]
});
