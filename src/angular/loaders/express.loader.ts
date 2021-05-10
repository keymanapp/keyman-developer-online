/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { AbstractHttpAdapter } from '@nestjs/core';

import { loadPackage } from '../angular.utils';
import { AngularModuleOptions } from '../interfaces/angular-options.interface';
import { AbstractLoader } from './abstract.loader';

@Injectable()
export class ExpressLoader extends AbstractLoader {
  public register(
    httpAdapter: AbstractHttpAdapter,
    options: AngularModuleOptions,
  ): void {
    const app = httpAdapter.getInstance();
    const express = loadPackage('express', 'AngularModule', () =>
      require('express'),
    );
    const clientPath: string = options.rootPath || '';
    const indexFilePath: string = this.getIndexFilePath(clientPath);

    app.use(express.static(clientPath, options.serveStaticOptions));
    app.get(options.renderPath, (req: any, res: any) =>
      res.sendFile(indexFilePath, { root: '.' }),
    );
  }
}
