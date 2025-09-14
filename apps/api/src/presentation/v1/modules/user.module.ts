import { Module } from '@nestjs/common';
import { UserController } from '../controllers/user.controller';
import { UserService } from '@/domain/user/services/user.service';
import { UserRepositoryImpl } from '@/domain/user/repositories/user.repository.impl';
import { DatabaseFactory } from '@/shared/database';
import { USER_REPOSITORY } from '@/shared/constants/injection-tokens';

@Module({
  controllers: [UserController],
  providers: [
    UserService,
    {
      provide: USER_REPOSITORY,
      useFactory: () => {
        const db = DatabaseFactory.getInstance();
        return new UserRepositoryImpl(db);
      },
    },
  ],
  exports: [UserService],
})
export class UserModule {}
