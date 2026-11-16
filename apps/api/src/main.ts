import "reflect-metadata";
import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // rawBody is needed for payment webhook signature verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("PrivateRide API")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(env.API_PORT);
  // eslint-disable-next-line no-console
  console.log(`PrivateRide API listening on :${env.API_PORT}`);
}

void bootstrap();
