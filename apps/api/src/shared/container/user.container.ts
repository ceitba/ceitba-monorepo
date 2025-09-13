import { UserRepository, UserRepositoryImpl, UserService } from "@/domain/user";
import { DatabaseFactory } from "@/shared/database";
import { ContainerInterface } from "@/shared/container/container.interface";
import { UserController } from "@/presentation/v1/controllers/user.controller";

export class UserContainer implements ContainerInterface {
    private static instance: UserContainer | null = null;

    private _userRepository: UserRepository | null = null;
    private _userService: UserService | null = null;
    private _userController: UserController | null = null;

    private constructor() {}

    static getInstance(): UserContainer {
        if (!this.instance) {
            this.instance = new UserContainer();
        }
        return this.instance;
    }

    get userRepository(): UserRepository {
        if (!this._userRepository) {
            const db = DatabaseFactory.getInstance();
            this._userRepository = new UserRepositoryImpl(db);
        }
        return this._userRepository;
    }

    get userService(): UserService {
        if (!this._userService) {
            this._userService = new UserService(this.userRepository);
        }
        return this._userService;
    }

    get userController(): UserController {
        if (!this._userController) {
            this._userController = new UserController(this.userService);
        }
        return this._userController;
    }

    reset(): void {
        UserContainer.instance = null;
        DatabaseFactory.reset();
    }

    getInstance(): UserContainer {
        return this;
    }
}