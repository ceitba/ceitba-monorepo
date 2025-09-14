import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { getSwaggerCustomCss, swaggerConfig } from './shared/utils/swagger-config';
import * as process from 'process';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  app.enableCors({
    origin: [
      'https://ceitba.org.ar',
      'http://localhost:3000',
      'http://localhost:3001'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
  });

  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('CEITBA API')
    .setDescription('CEITBA API for managing ITBA academic data and users')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  
  const swaggerOptions = {
    ...swaggerConfig,
    customCss: getSwaggerCustomCss(),
  };
  
  SwaggerModule.setup('api/docs', app, document, swaggerOptions);

  app.use('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(document);
  });

  const PORT = process.env.PORT || 3000;
  await app.listen(PORT);

  console.log(`CEITBA API Server running on port ${PORT}`);
  console.log(`API Documentation available at: http://localhost:${PORT}/api/docs`);
  console.log(`Health check available at: http://localhost:${PORT}/api/health`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
