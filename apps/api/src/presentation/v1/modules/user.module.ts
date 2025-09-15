import { Module } from '@nestjs/common';
import { UserController } from '../controllers/user.controller';
import { UserService } from '@/domain/user/services/user.service';
import { UserRepositoryImpl } from '@/domain/user/repositories/user.repository.impl';
import { PrismaService } from '@/shared/database/prisma.service';
import { USER_REPOSITORY } from '@/shared/constants/injection-tokens';

@Module({
  controllers: [UserController],
  providers: [
    PrismaService,
    UserService,
    {
      provide: USER_REPOSITORY,
      useFactory: (prismaService: PrismaService) => {
        return new UserRepositoryImpl(prismaService);
      },
      inject: [PrismaService],
    },
  ],
  exports: [UserService],
})
export class UserModule {}
