import { startApp } from 'modelence/server';

import memoryModule from './memory';
import connectorsModule from './connectors';
import openApiModule from './openapi';

startApp({
  modules: [memoryModule, connectorsModule, openApiModule]
});
