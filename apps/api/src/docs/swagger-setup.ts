import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import { Express } from 'express';

export function setupSwagger(app: Express) {
    const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));

    const options = {
        explorer: true,
        customCss: '.swagger-ui .topbar { display: none }', 
        customSiteTitle: 'CEITBA API Documentation',
        swaggerOptions: {
            filter: true,
            showRequestDuration: true,
        }
    }

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
  
    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerDocument);
    });
}