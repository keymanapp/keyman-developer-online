import { CookieParserMiddleware } from '@nest-middlewares/cookie-parser';
import { ExpressSessionMiddleware } from '@nest-middlewares/express-session';
import { HelmetMiddleware } from '@nest-middlewares/helmet';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { AngularModule } from './angular/angular.module';
import { AuthModule } from './auth/auth.module';
import { BackendProjectModule } from './backend-project/backend-project.module';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { GitModule } from './git/git.module';
import { GitService } from './git/git.service';
import { GithubModule } from './github/github.module';
import { ProjectsModule } from './projects/projects.module';
import { PullRequestModule } from './pull-request/pull-request.module';

import memoryStoreModule = require('memorystore');
import expressSession = require('express-session')
const MemoryStore = memoryStoreModule(expressSession);

@Module({
  imports: [
    AngularModule.forRoot({
      rootPath: 'frontend/dist/frontend',
    }),
    AuthModule,
    ConfigModule,
    ProjectsModule,
    GithubModule,
    BackendProjectModule,
    GitModule,
    PullRequestModule,
  ],
  controllers: [],
  providers: [GitService],
})
export class AppModule implements NestModule {
  constructor(private readonly configService: ConfigService) { }

  configure(consumer: MiddlewareConsumer): void {
    CookieParserMiddleware.configure(this.configService.sessionSecret);
    HelmetMiddleware.configure({
      contentSecurityPolicy: {
        directives: {
          // tslint:disable-next-line: quotemark
          defaultSrc: ['\'self\''],
        },
      },
      frameguard: {
        action: 'deny',
      },
    });

    const cookie = {
      maxAge: this.configService.cookieMaxAge,
      httpOnly: true,
      secure: true,
      expires: new Date(
        new Date().getTime() +
        this.configService.expiresDays * 24 * 60 * 60 * 1000, // 24 hrs * 60 min * 60 sec * 1000 ms
      ),
    };

    if (process.env.NODE_ENV !== 'production') {
      cookie.secure = false;
    }

    const sessionOpts: expressSession.SessionOptions = {
      secret: this.configService.sessionSecret,
      cookie,
      saveUninitialized: false,
      resave: false,
    };

    if (process.env.NODE_ENV !== 'test') {
      // It seems that MemoryStore has a bug (https://github.com/roccomuso/memorystore/issues/11)
      // so that it doesn't properly shut down when unit tests end. On the other hand it is safe
      // to be used in production.
      sessionOpts.store = new MemoryStore({
        checkPeriod: 24 * 60 * 60 * 1000, // 24 hrs * 60 min * 60 sec * 1000 ms
      });
    } else {
      cookie.secure = false;
      sessionOpts.store = new expressSession.MemoryStore();
    }

    ExpressSessionMiddleware.configure(sessionOpts);

    consumer.apply(CookieParserMiddleware).forRoutes('/');
    consumer.apply(HelmetMiddleware).forRoutes('/');
    consumer.apply(ExpressSessionMiddleware).forRoutes('/');

    // NOTE: Adding CSRF protection for the API is counter productive
    // see https://github.com/pillarjs/understanding-csrf
  }
}
