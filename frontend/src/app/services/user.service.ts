import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { GitHubUser } from '../model/git-hub-user';
import { User } from '../model/user';
import { ErrorHelper } from '../utils/error-helper';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private loginUrl = `${environment.apiUrl}/auth/login`;
  private userProfileUrl = `${environment.apiUrl}/auth/user`;
  private gitHubUserProfile: GitHubUser;

  constructor(
    private http: HttpClient,

    private errorHelper: ErrorHelper,
    private user: User,
  ) {}

  public login(): Observable<string> {
    return this.http.get<{ url: string }>(this.loginUrl).pipe(
      catchError(this.errorHelper.handleError('GET login REST API', { url: '' })),
      map(obj => obj.url),
    );
  }

  public getAccessToken(code: string, state: string): Observable<string> {
    return this.http
      .post<{ accessToken: string }>(this.loginUrl, {
        code,
        state,
      })
      .pipe(
        catchError(
          this.errorHelper.handleError(
            `POST getAccessToken(${code}, ${state}) REST API`,
            { accessToken: '' },
          ),
        ),
        map(obj => obj.accessToken),
      );
  }

  public getUserProfile(): Observable<GitHubUser> {
    return this.http.get<GitHubUser>(this.userProfileUrl, {
      headers: { Authorization: `token ${this.accessToken}` },
    });
  }

  public get accessToken(): string {
    return this.user.accessToken;
  }

  public set accessToken(value: string) {
    this.user.accessToken = value;
  }

  public get gitHubCode(): string {
    return this.user.gitHubCode;
  }

  public set gitHubCode(value: string) {
    this.user.gitHubCode = value;
  }

  public get gitHubState(): string {
    return this.user.gitHubState;
  }

  public set gitHubState(value: string) {
    this.user.gitHubState = value;
  }

  public get userProfile(): GitHubUser {
    if (this.gitHubUserProfile == null) {
      this.gitHubUserProfile = this.user.userProfile;
    }
    return this.gitHubUserProfile;
  }

  public set userProfile(value: GitHubUser) {
    this.user.userProfile = value;
  }

  public logout(): Observable<string> {
    this.user.clear();

    return this.http.delete<{ url: string }>(this.loginUrl).pipe(
      catchError(this.errorHelper.handleError('DELETE login REST API', { url: '' })),
      map(obj => obj.url),
    );
  }

  public isLoggedIn(): boolean {
    return this.accessToken != null;
  }
}
