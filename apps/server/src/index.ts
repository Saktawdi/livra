import { createApp } from './app.ts';
const { app } = await createApp({ logger: true });
await app.listen({ port: Number(process.env.PORT || 3400), host: process.env.HOST || '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
