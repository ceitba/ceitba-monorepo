import * as fs from 'fs';
import * as path from 'path';

export function getSwaggerCustomCss(): string {
  try {
    const cssPath = path.join(__dirname, '../styles/swagger.css');
    return fs.readFileSync(cssPath, 'utf8');
  } catch (error) {
    console.warn('Could not load custom Swagger CSS:', error);
    return '';
  }
}

export const swaggerConfig = {
  explorer: true,
  customSiteTitle: 'CEITBA API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    filter: true,
    showRequestDuration: true,
    tryItOutEnabled: true,
    requestSnippetsEnabled: true,
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
    displayOperationId: false,
    displayRequestDuration: true,
    docExpansion: 'list',
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
  }
};
