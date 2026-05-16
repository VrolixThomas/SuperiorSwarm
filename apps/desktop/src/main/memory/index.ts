import { listDecisions, logDecision } from "./decisions";
import { addFollowup, listFollowups, updateFollowup } from "./followups";
import { type FtsHit, type FtsKind, ftsSearch } from "./fts";
import { addGoal, deleteGoal, listGoals, updateGoal } from "./goals";
import {
	deleteJournal,
	journalAppend,
	journalEnd,
	journalStart,
	readJournal,
	recentJournals,
} from "./journal";
import { addQuestion, answerQuestion, listQuestions } from "./questions";

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
