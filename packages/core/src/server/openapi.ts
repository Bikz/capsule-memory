import { Module } from 'modelence/server';

import openApiSource from '../openapi.yaml?raw';

export default new Module('openapi', {
  routes: [
    {
      path: '/openapi.yaml',
      handlers: {
        get: async () => ({
          data: openApiSource,
          status: 200,
          headers: {
            'content-type': 'application/yaml; charset=utf-8'
          }
        })
      }
    }
  ]
});
