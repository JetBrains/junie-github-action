import {JunieExecutionContext} from "../../context";
import {ActionType} from "../../../entrypoints/handle-results";

export interface FinishFeedbackData {
    initCommentId?: string;
    isJobFailed: boolean;
    parsedContext: JunieExecutionContext;
    successData?: SuccessFeedbackData;
    failureData?: FailureFeedbackData;
}

export interface SuccessFeedbackData {
    actionToDo: keyof typeof ActionType;
    prLink?: string;
    commitSHA?: string;
    junieTitle?: string;
    junieSummary?: string;
    workingBranch?: string;
    baseBranch?: string;
}

export interface FailureFeedbackData {
    error?: string;
}
