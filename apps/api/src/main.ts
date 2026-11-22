import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { loadEnv } from "./config/env";
import { assertProviderConfig } from "./providers/provider-env";

async function bootstrap() {
  loadEnv();
  assertProviderConfig(); // fail fast: <KIND>_MODE=real without URL / key / webhook secret / sender never boots (names only, no values logged)
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Kiorly Team (Expo web, dev) and the lab web app; native apps do not use CORS. Override with CORS_ORIGINS in other environments.
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? "http://localhost:5191,http://127.0.0.1:5191,http://localhost:8082,http://127.0.0.1:8082").split(","), credentials: false });
  configureApp(app);
  const port = Number(process.env.PORT ?? 3200);
  const host = process.env.LISTEN_HOST ?? "0.0.0.0";
  await app.listen(port, host);
  console.log(`Kiorly Lab API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
