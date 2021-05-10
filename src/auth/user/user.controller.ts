/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Session, ValidationPipe
} from '@nestjs/common';
import {
  ApiBasicAuth, ApiBody, ApiHeader, ApiOAuth2, ApiOkResponse, ApiOperation, ApiParam, ApiResponse,
  ApiTags, ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { Observable } from 'rxjs';

import { GithubService } from '../../github/github.service';
import { GitHubUser } from '../../interfaces/git-hub-user.interface';
import { GitHubAccessToken } from '../../interfaces/github-access-token.interface';
import { callWithErrorHandling } from '../../utils/call-with-error-handling';
import { AccessTokenDto } from '../model/access-token-dto';
import { GitHubUserDto } from '../model/git-hub-user-dto';
import { LoginDto } from '../model/login-dto';
import { UrlDto } from '../model/url-dto';

@Controller('auth')
@ApiTags('user related')
export class UserController {
  constructor(private readonly githubService: GithubService) { }

  @Get('login')
  @ApiOperation({
    summary: 'Get the GitHub URL for login',
    description: 'Get the GitHub URL that can be used to login and authenticate the user.',
  })
  @ApiResponse({
    status: 200,
    description: 'The server returns a JSON object with the URL. The client should redirect ' +
      'to that URL so that the user can authenticate with GitHub.',
    type: UrlDto,
  })
  public login(@Session() session: any): Observable<UrlDto> {
    return this.githubService.login(session);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Retrieve the access token',
    description: 'The server retrieves and returns the access token that can be used for ' +
      'accessing GitHub APIs.',
  })
  @ApiBody({
    description: 'Login information',
    required: true,
    type: LoginDto,
  })
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description: 'The access token that can be used for accessing GitHub APIs.',
    type: AccessTokenDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  public async getAccessToken(
    @Body(new ValidationPipe()) loginDto: LoginDto,
  ): Promise<AccessTokenDto> {
    return callWithErrorHandling(
      () => this.githubService.getAccessToken(loginDto.code, loginDto.state),
      response => {
        const ghToken = response.data as GitHubAccessToken;
        return new AccessTokenDto(ghToken.access_token);
      },
      AccessTokenDto,
    );
  }

  @Delete('login')
  @ApiOperation({
    summary: 'Logout',
    description: 'Logout of the Keyman Developer Online server.',
  })
  @ApiResponse({
    status: 200,
    description: 'User logged out of the Keyman Developer Online server',
    type: UrlDto,
  })
  public logout(): Observable<UrlDto> {
    return this.githubService.logout();
  }

  @Get('user')
  @ApiOAuth2(['read:user', 'user:email'], 'Default')
  @ApiBasicAuth('Tests')
  @ApiOperation({
    summary: 'Get user information',
    description: 'Get information about the currently logged in user.',
  })
  @ApiHeader({
    // This header is required, however it's taken care of by the security schemas.
    // Setting `required: false` here allows to try the API through the Swagger UI
    // without explicitly filling in the authorization token.
    name: 'authorization',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'GitHub user information', type: GitHubUserDto })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  public async getUserInformation(
    @Session() session: any,
    @Headers('authorization') token: string,
  ): Promise<GitHubUserDto> {
    return callWithErrorHandling(
      () => this.githubService.getUserInformation(token),
      response => {
        const user = response.data as GitHubUser;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        session.login = user.login;
        return new GitHubUserDto(user);
      },
      GitHubUserDto,
    );
  }

  // Method used in tests to set the username in the session
  @Get('user/test/:username')
  @ApiBasicAuth('Tests')
  @ApiOperation({
    summary: 'Set username for tests',
    description: 'Used in tests to set the username in the session',
  })
  @ApiHeader({
    name: 'authorization',
    description: 'The base64 encoded GitHub username and password (`Basic username:password`)',
    example: 'Basic 9...',
    required: false,
  })
  @ApiParam({
    name: 'username',
    type: 'string',
  })
  @ApiOkResponse({description: 'OK'})
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  public getUser(
    @Session() session: any,
    @Headers('authorization') token: string,
    @Param() params: any,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    session.login = params.username;
  }
}
