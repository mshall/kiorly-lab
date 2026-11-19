import "reflect-metadata";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../src/app.module";
import { loadEnv } from "../src/config/env";

/** Writes docs/openapi.json (Kiorly Lab API). Run: npm run openapi -w api */
async function main() {
  loadEnv();
  process.env.TIMERS_ENABLED = "false";
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Kiorly Lab API").setDescription("Kiorly Lab LIMS API (KX-07). Bearer JWT (Kiorex Account in production, dev login locally); HMAC for /integration/v1.").setVersion("1.0.0").addBearerAuth().build());
  const out = resolve(__dirname, "../../../Docs/openapi.json");
  mkdirSync(resolve(out, ".."), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`wrote ${out} (${Object.keys(doc.paths).length} paths)`);
  await app.close();
}
void main();
