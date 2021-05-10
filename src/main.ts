import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AuthGuard } from './auth/auth.guard';
import { ConfigService } from './config/config.service';
import { GithubService } from './github/github.service';

import express = require('express');
import rateLimit = require('express-rate-limit');

async function bootstrap(): Promise<void> {
  const config = new ConfigService();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // see https://expressjs.com/en/guide/behind-proxies.html and
  // https://github.com/expressjs/session/issues/251. In short you'll also
  // have to set `RequestHeader set X-Forwarded-Proto "https"` in Apache.
  app.set('trust proxy', true);

  // Azure uses x-arr-ssl header instead of x-forwarded-proto. Therefore we
  // add middleware that will trick Express into thinking the request is secure.
  // See http://scottksmith.com/blog/2014/08/22/using-secure-cookies-in-node-on-azure/
  app.use((req, res, next) => {
    if (req.headers['x-arr-ssl'] && !req.headers['x-forwarded-proto']) {
      req.headers['x-forwarded-proto'] = 'https';
    }
    return next();
  });

  app.useGlobalGuards(new AuthGuard());
  app.enableCors();
  app.use(
    express.urlencoded({ extended: false }),
    express.json({ type: () => true }),
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
    }),
  );
  app.setGlobalPrefix('api');

  const options = new DocumentBuilder()
    .setTitle('Keyman Developer Online API')
    .setDescription(`<p>Contribute keyboards to the Keyman keyboards repo. The API allows to
convert a single keyboard repo into a pull request on the huge
<a href="https://github.com/keymanapp/keyboards">keyboards</a> repo.</p>
<p>The OpenAPI JSON file can be downloaded <a href="/api-json">here</a>.</p>`)
    .setVersion('0.1')
    .addTag('user related')
    .addTag('project related')
    .addOAuth2(
      // NOTE: Currently it's not possible to login through Swagger UI using this kind of
      // authentication. I guess I'm missing something, but I cannot figure out what...
    {
      type: 'oauth2',
      description: 'just testing',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          scopes: GithubService.scope.split(' '),
        }
      }
    }, 'Default')
    .addBasicAuth({
      type: 'http',
      description: 'Used only in e2e tests. Use GitHub <b>username</b> and <b>personal access token</b>.',
    }, 'Tests')
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api', app, document);

  await app.listen(config.port, config.bindingHost);
}
await bootstrap();
