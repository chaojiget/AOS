import { Global, Module } from "@nestjs/common";
import { ApiConfigModule } from "../config/api-config.module";
import { DatabaseService } from "./database.service";

@Global()
@Module({
  imports: [ApiConfigModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
