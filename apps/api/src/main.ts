import "reflect-metadata";
import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // rawBody is needed for payment webhook signature verification.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // Behind a tunnel or load balancer every request arrives from the proxy's
  // address; without this, rate limits and audit IPs lump all users together.
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }

  app.use(helmet());
  app.enableCors({
    origin:
      env.NODE_ENV === "production"
        ? (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean)
        : true,
    credentials: true,
  });
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
