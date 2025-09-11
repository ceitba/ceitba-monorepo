import { ApiClient, ExternalApiConfig } from './api-client.interface';
import { FetchApiClient } from './fetch-api-client';

export class ApiFactory {
    private static clients: Map<string, ApiClient> = new Map();

    static createClient(name: string, config: ExternalApiConfig): ApiClient {
        if (this.clients.has(name)) {
            return this.clients.get(name)!;
        }

        const client = new FetchApiClient(config);
        this.clients.set(name, client);
        return client;
    }

    static createNewClient(config: ExternalApiConfig): ApiClient {
        return new FetchApiClient(config);
    }

    static getClient(name: string): ApiClient | undefined {
        return this.clients.get(name);
    }

    static removeClient(name: string): void {
        this.clients.delete(name);
    }

    static clearClients(): void {
        this.clients.clear();
    }

    static createItbaApiClient(apiToken: string): ApiClient {
        return this.createClient('itba-api', {
            baseUrl: 'https://itbagw.itba.edu.ar/api/v1',
            defaultHeaders: {
                'Content-Type': 'application/json',
            },
            timeout: 30000
        });
    }
}
