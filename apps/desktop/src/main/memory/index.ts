import {
	addFollowup,
	listFollowups,
	updateFollowup,
} from "./followups";
import { addGoal, deleteGoal, listGoals, updateGoal } from "./goals";
import {
	addQuestion,
	answerQuestion,
	listQuestions,
} from "./questions";
import { listDecisions, logDecision } from "./decisions";
import {
	deleteJournal,
	journalAppend,
	journalEnd,
	journalStart,
	readJournal,
	recentJournals,
} from "./journal";
import { ftsSearch, type FtsHit, type FtsKind } from "./fts";

export interface SearchInput {
	projectId: string;
	query: string;
	kinds?: FtsKind[];
	limit?: number;
}

export type SearchHit = FtsHit;

function search(input: SearchInput): SearchHit[] {
	return ftsSearch(input);
}

export const memory = {
	addGoal,
	updateGoal,
	listGoals,
	deleteGoal,
	addFollowup,
	updateFollowup,
	listFollowups,
	logDecision,
	listDecisions,
	addQuestion,
	answerQuestion,
	listQuestions,
	journalStart,
	journalAppend,
	journalEnd,
	readJournal,
	recentJournals,
	deleteJournal,
	search,
};

export type { FtsKind } from "./fts";
