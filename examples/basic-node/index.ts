import { InMemoryStore } from '@capsule/core';

async function main() {
  const store = new InMemoryStore();
  const meta = await store.add({ content: 'hello capsule', meta: { tags: ['demo'] } });
  console.log('added:', meta);
  console.log('search:', await store.search('hello', 3));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
