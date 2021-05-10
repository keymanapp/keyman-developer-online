import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { Project } from '../model/project';
import { ErrorHelper } from '../utils/error-helper';
import { UserService } from './user.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectsService {
  constructor(
    private readonly http: HttpClient,
    private readonly userService: UserService,
    private readonly errorHelper: ErrorHelper
  ) { }

  public getRepos(): Observable<Project[]> {
    return this.http.get<{ project }[]>(`${environment.apiUrl}/projects/all`, {
      headers: { Authorization: `token ${this.userService.accessToken}` },
    }).pipe(
      catchError(this.errorHelper.handleError('GET projects/all REST API', null)),
      map(obj => obj.map(({ name }) => new Project(name, name !== 'keyboards'))),
    );
  }
}
