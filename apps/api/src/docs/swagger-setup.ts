import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import { Express, Request, Response } from 'express';
import fs from 'fs';

interface OpenAPIDocument {
    openapi: string;
    info: any;
    servers: any[];
    tags: any[];
    paths: Record<string, any>;
    components: {
        schemas: Record<string, any>;
        responses?: Record<string, any>;
        parameters?: Record<string, any>;
    };
}

function loadYamlFile(filePath: string): any {
    try {
        if (fs.existsSync(filePath)) {
            return YAML.load(filePath);
        }
        console.warn(`YAML file not found: ${filePath}`);
        return null;
    } catch (error) {
        console.error(`Error loading YAML file ${filePath}:`, error);
        return null;
    }
}

function mergeOpenAPIDocuments(): OpenAPIDocument {
    const docsPath = path.join(__dirname, 'openapi');
    
    const mainDoc = loadYamlFile(path.join(docsPath, 'openapi.yaml'));
    if (!mainDoc) {
        throw new Error('Main OpenAPI document not found');
    }

    const mergedDoc: OpenAPIDocument = {
        openapi: mainDoc.openapi,
        info: mainDoc.info,
        servers: mainDoc.servers,
        tags: mainDoc.tags,
        paths: { ...mainDoc.paths },
        components: {
            schemas: {},
            responses: {},
            parameters: {}
        }
    };

    const schemasPath = path.join(docsPath, 'components', 'schemas', 'itba-schemas.yaml');
    const schemas = loadYamlFile(schemasPath);
    if (schemas) {
        mergedDoc.components.schemas = { ...mergedDoc.components.schemas, ...schemas };
        console.log('Loaded ITBA schemas');
    }

    const pathFiles = [
        { file: 'paths/itba/careers.yaml', prefix: '/itba' },
        { file: 'paths/itba/subject-plans.yaml', prefix: '/itba' },
        { file: 'paths/itba/classrooms.yaml', prefix: '/itba' }
    ];

    pathFiles.forEach(({ file, prefix }) => {
        const pathDoc = loadYamlFile(path.join(docsPath, file));
        if (pathDoc) {
            Object.keys(pathDoc).forEach(pathKey => {
                const fullPath = pathKey.startsWith('/') ? pathKey : `${prefix}${pathKey}`;
                mergedDoc.paths[fullPath] = pathDoc[pathKey];
            });
            console.log(`Loaded paths from ${file}`);
        }
    });

    mergedDoc.components.responses = {
        NotFound: {
            description: 'Resource not found',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            error: { type: 'string' },
                            path: { type: 'string' },
                            method: { type: 'string' },
                            timestamp: { type: 'string', format: 'date-time' }
                        }
                    }
                }
            }
        },
        BadRequest: {
            description: 'Invalid request data',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            error: { type: 'string' },
                            field: { type: 'string' },
                            value: { type: 'string' }
                        }
                    }
                }
            }
        },
        InternalServerError: {
            description: 'Internal server error',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            error: { type: 'string' },
                            message: { type: 'string' },
                            timestamp: { type: 'string', format: 'date-time' }
                        }
                    }
                }
            }
        }
    };

    mergedDoc.components.schemas.Error = {
        type: 'object',
        properties: {
            error: { type: 'string', description: 'Error message' },
            code: { type: 'string', description: 'Error code' },
            details: { type: 'object', description: 'Additional error details' }
        },
        required: ['error']
    };

    mergedDoc.components.schemas.ValidationError = {
        type: 'object',
        properties: {
            error: { type: 'string', description: 'Validation error message' },
            field: { type: 'string', description: 'Field that failed validation' },
            value: { type: 'string', description: 'Invalid value provided' }
        },
        required: ['error', 'field']
    };

    return mergedDoc;
}

export function setupSwagger(app: Express) {
    try {
        console.log('Setting up Swagger documentation...');
        
        const swaggerDocument = mergeOpenAPIDocuments();
        
        console.log(`Loaded ${Object.keys(swaggerDocument.paths).length} paths`);
        console.log(`Loaded ${Object.keys(swaggerDocument.components.schemas).length} schemas`);

        const options = {
            explorer: true,
            customCss: `
                .swagger-ui .topbar { display: none }
                .swagger-ui .info { margin: 20px 0; }
                .swagger-ui .info .title { color: #1976d2; }
                .swagger-ui .scheme-container { background: #fafafa; padding: 10px; }
                .swagger-ui .opblock.opblock-get { border-color: #61affe; }
                .swagger-ui .opblock.opblock-post { border-color: #49cc90; }
                .swagger-ui .opblock.opblock-put { border-color: #fca130; }
                .swagger-ui .opblock.opblock-delete { border-color: #f93e3e; }
            `, 
            customSiteTitle: 'CEITBA API Documentation',
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
                operationsSorter: 'alpha'
            }
        };

        app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
        
        app.get('/api-docs.json', (req: Request, res: Response) => {
            res.setHeader('Content-Type', 'application/json');
            res.json(swaggerDocument);
        });

        app.get('/api-docs.yaml', (req: Request, res: Response) => {
            res.setHeader('Content-Type', 'text/yaml');
            res.send(YAML.stringify(swaggerDocument, 4));
        });

        console.log('Swagger documentation setup completed');
        
    } catch (error) {
        console.error('Failed to setup Swagger documentation:', error);
        console.error('Stack trace:', error instanceof Error ? error.stack : 'Unknown error');
    }
}