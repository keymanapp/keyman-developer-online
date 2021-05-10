import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, ParamMap } from '@angular/router';

import { switchMap } from 'rxjs/operators';

import { GitHubPullRequest } from '../../model/git-hub-pull-request';
import { SingleProjectService } from '../../services/single-project.service';
import { ErrorHelper } from '../../utils/error-helper';

@Component({
  selector: 'app-pull-request',
  templateUrl: './pull-request.component.html',
  styleUrls: ['./pull-request.component.scss']
})
export class PullRequestComponent implements OnInit {
  public pullRequest: GitHubPullRequest;
  public updatePullRequest: boolean;
  public message: string;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly errorHelper: ErrorHelper,
    private readonly service: SingleProjectService,
  ) { }

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap((params: ParamMap) => {
        this.updatePullRequest = params.get('prExists') === 'existing';
        return this.service.createPullRequest(
          params.get('name'),
          params.get('prefix'),
          params.get('keyboardId'),
        );
      }),
    ).subscribe(
      (pullRequest: GitHubPullRequest) => this.pullRequest = pullRequest,
      (err: HttpErrorResponse) => {
        if (err.status === 304) {
          this.message = 'There are no new changes on this single-keyboard repo.';
        } else if (err.status === 409) {
          this.message = 'Keyboards repo has new changes in the single-keyboard directory. This is not allowed.';
        } else if (err.status === 412) {
          this.message = 'Non-linear history in single-keyboard repo. Force-push is not allowed.';
        } else if (err.status === 401 || err.status === 403) {
          this.errorHelper.handleUnauthorized();
        } else {
          this.message = `ERROR ${err.status}: ${err.statusText}.`;
        }
      }
    );
  }

  public get appliedAction(): string {
    if (this.pullRequest.action === 'created') {
      return this.pullRequest.action;
    }
    return 'updated';
   }
}
