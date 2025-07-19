# CEITBA-API

CEITBA-API is a Node.js/TypeScript REST API for managing ITBA student and club data, including proposals, benefits, attendance, user management, and more. It is designed for the CEITBA community to streamline club operations and integrate with ITBA systems.

## Features

- User and staff management
- Proposals and voting system
- Benefits and attendance tracking
- ITBA career and classroom integration
- Scheduler and event management
- Minecraft whitelist management
- Modular and extensible architecture

## Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/CEITBA/CEITBA-API.git
   cd CEITBA-API
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Configure environment variables as needed (see `v1/config/supabase.ts` for database setup).


## Usage

Start the server:

```sh
npm start
```

The API will be available at `http://localhost:3000` (or your configured port).

## Documentation

To view the API documentation, start the server and open:

```
http://localhost:3000/docs
```

This will display the interactive API docs (Swagger UI or similar, if enabled in your configuration).

## API Structure

- `v1/app/` – Main application routes and models
- `v1/benefits/` – Benefits, attendance, and inscription endpoints
- `v1/itba/` – ITBA integration (careers, classrooms, subjects)
- `v1/minecraft/` – Minecraft whitelist management
- `v1/scheduler/` – Scheduler and event routes
- `v1/user/` – User, staff, and authentication modules
- `v1/middleware/` – Request validation middleware
- `v1/config/` – Supabase and other configuration

## Development

- TypeScript is used throughout the project.
- Linting and formatting are recommended (add ESLint/Prettier as needed).
- Tests can be run with:
  ```sh
  npm test
  ```

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License

MIT License. See [LICENSE](LICENSE) for details.