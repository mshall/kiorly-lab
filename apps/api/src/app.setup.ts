import { INestApplication, ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";

/** Shared by main.ts and e2e tests so they boot identically. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix("api/v1");
  // keep the raw body for HMAC verification (Kiorex/Clinic requests, flag.changed webhook)
  (app as NestExpressApplication).useBodyParser("json", { limit: "5mb", verify: (req: { rawBody?: Buffer }, _res: unknown, buf: Buffer) => { req.rawBody = buf; } });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  if (process.env.SWAGGER_ENABLED !== "false") {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("Kiorly Lab API").setDescription("Kiorly Lab LIMS API (KX-07). Bearer JWT (Kiorex Account in production, dev login locally); HMAC for /integration/v1.").setVersion("1.0.0").addBearerAuth().build(),
    );
    SwaggerModule.setup("docs", app, doc);
  }
}
