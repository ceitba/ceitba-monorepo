import { 
    ApiClient, 
    ApiResponse, 
    ApiError, 
    RequestConfig, 
    ExternalApiConfig 
} from '@/shared/external-apis/api-client.interface';

export class FetchApiClient implements ApiClient {
    private readonly config: ExternalApiConfig;

    constructor(config: ExternalApiConfig) {
        this.config = config;
    }

    async get<T>(url: string, config?: RequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>(url, { ...config, method: 'GET' });
    }

    async post<T>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>(url, { ...config, method: 'POST', body: data });
    }

    async put<T>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>(url, { ...config, method: 'PUT', body: data });
    }

    async delete<T>(url: string, config?: RequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>(url, { ...config, method: 'DELETE' });
    }

    async patch<T>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>(url, { ...config, method: 'PATCH', body: data });
    }

    private async request<T>(url: string, config: RequestConfig = {}): Promise<ApiResponse<T>> {
        try {
            const fullUrl = this.buildUrl(url, config.params);
            const headers = this.buildHeaders(config.headers);
            
            const fetchConfig: RequestInit = {
                method: config.method || 'GET',
                headers,
                signal: this.createTimeoutSignal(config.timeout)
            };

            if (config.body && config.method !== 'GET') {
                fetchConfig.body = typeof config.body === 'string' 
                    ? config.body 
                    : JSON.stringify(config.body);
                
                if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/json';
                }
            }

            const response = await fetch(fullUrl, fetchConfig);
            const data = await this.parseResponse<T>(response);

            return {
                data,
                error: null,
                status: response.status
            };

        } catch (error) {
            return {
                data: null,
                error: this.mapError(error as Error),
                status: 0
            };
        }
    }

    private buildUrl(url: string, params?: Record<string, any>): string {
        const fullUrl = url.startsWith('http') ? url : `${this.config.baseUrl}${url}`;
        
        if (!params || Object.keys(params).length === 0) {
            return fullUrl;
        }

        const urlObj = new URL(fullUrl);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                urlObj.searchParams.append(key, String(value));
            }
        });

        return urlObj.toString();
    }

    private buildHeaders(requestHeaders?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            ...this.config.defaultHeaders,
            ...requestHeaders
        };

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        return headers;
    }

    private createTimeoutSignal(timeout?: number): AbortSignal | undefined {
        const timeoutMs = timeout || this.config.timeout;
        
        if (!timeoutMs) {
            return undefined;
        }

        const controller = new AbortController();
        setTimeout(() => controller.abort(), timeoutMs);
        return controller.signal;
    }

    private async parseResponse<T>(response: Response): Promise<T> {
        const contentType = response.headers.get('Content-Type');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (contentType?.includes('application/json')) {
            return response.json() as Promise<T>;
        }

        if (contentType?.includes('text/')) {
            return response.text() as unknown as T;
        }

        return response.blob() as unknown as T;
    }

    private mapError(error: Error): ApiError {
        if (error.name === 'AbortError') {
            return {
                code: 'TIMEOUT',
                message: 'Request timeout',
                details: error
            };
        }

        if (error.message.startsWith('HTTP')) {
            return {
                code: 'HTTP_ERROR',
                message: error.message,
                details: error
            };
        }

        return {
            code: 'NETWORK_ERROR',
            message: error.message || 'Network request failed',
            details: error
        };
    }
}
