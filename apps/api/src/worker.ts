import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'ai-commerce-api',
  }),
);

export default app;
