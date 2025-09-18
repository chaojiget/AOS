import { Module } from "@nestjs/common";
import { RunsService } from "./runs.service";
import { RunsController } from "./runs.controller";
import { DefaultRunKernelFactory, RUN_KERNEL_FACTORY } from "./run-kernel.factory";

@Module({
  providers: [RunsService, { provide: RUN_KERNEL_FACTORY, useClass: DefaultRunKernelFactory }],
  controllers: [RunsController],
  exports: [RunsService],
})
export class RunsModule {}
