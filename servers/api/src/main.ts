import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ApiConfigService } from "./config/api-config.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ApiConfigService);

  app.enableCors({
    origin: config.allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    exposedHeaders: ["content-type"],
  });

  app.setGlobalPrefix("api");

  const port = config.port;
  await app.listen(port);
  const logger = new Logger("Bootstrap");
  logger.log(`API server listening on port ${port}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("API bootstrap failed", error);
  process.exitCode = 1;
});
