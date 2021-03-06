# Keyman Developer Online

## Description

A server that makes the task of contributing new keyboards to https://keyman.com/ easier without requiring
an initial download of 1 GB of data.

The backend is implemented with [nest](https://nestjs.com/), the included frontend with
[angular](https://angular.io/).

## Installation

Install `node` version 12.x and `npm` version 6.13.x. Then run the following commands:

```bash
# Install nestjs and angular
$ npm i -g @nestjs/cli @angular/cli gulp-cli

# Install dependencies
$ gulp install
```

## Preparation

Before you'll be able to run the app, you'll have to create a `development.env` or `production.env`
file. You can take the existing `test.env` file as template.

You'll also have to create an [OAuth App on GitHub](https://github.com/settings/developers).
Use `http://localhost:3000` as _Homepage URL_ and _Authorization callback URL_.

In the `*.env` file replace the values for `CLIENT_ID` and `CLIENT_SECRET` with the _Client ID_ and
_Client Secret_ that GitHub displays for the app. You should also replace the value for
`SESSION_SECRET` with a random value.

If you want to run all e2e tests, you'll have to create a test user on GitHub. Fork
[keymanapp/test_kdo_khmer_angkor](https://github.com/keymanapp/test_kdo_khmer_angkor) to your test
account and set two environment variables before running the e2e tests:

```bash
export TEST_GITHUB_USER=<GitHubTestUser>
export TEST_GITHUB_TOKEN=<PersonalAccessTokenForGitHubTestUser>
```

## Development

```bash
# Building (front- and backend)
$ gulp build

# Build backend (watching for changes)
$ npm run build:watch

# Build frontend (watching for changes)
$ cd frontend
$ npm run build:watch
```

**Note:** You can use the `gulp` default target to install, build, and run unit and
e2e tests on back- and frontend with a single command:

```bash
$ gulp
```

### Debug Output

Various components can print debug output. To enable the debug output, check the component
you're interested in and set the `DEBUG` environment variable.

For example, `git.service.ts` contains the following line close to the top of the file:

```csharp
const debug = debugModule('debug');
const trace = debugModule('kdo:git');
```

To get the `trace` output you can set the environment variable:

```bash
$ export DEBUG=kdo:git
```

## Test

```bash
# unit tests (front- and backend)
$ gulp test

# e2e tests (front- and backend)
$ gulp e2e

# test coverage (backend)
$ npm run test:cov
```

**NOTE:** You might have to set the `CHROMEDRIVER_VERSION` environment variable to the
installed Chrome version, e.g. `export CHROMEDRIVER_VERSION=76.0.3809.100`.

## Running the app

**Note:** you'll have to build the frontend first!

```bash
# development (http://localhost:3000)
$ npm run start

# watch mode
$ npm run start:watch:dev

# production mode
$ npm run start:prod
```

## Deployment

We use Docker to create a container that can be deployed to wherever:

```bash
$ docker-compose build
```

Before you can deploy to production, you'll have to create an OAuth App on GitHub and edit the file
`production.env` (see above). Then you can run:

```bash
$ export NODE_ENV=production
$ docker-compose up -d
```

## License

Keyman Developer Online is [MIT licensed](LICENSE).
