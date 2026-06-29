export interface Account {
  username: string;
  password: string;
  role: "admin" | "user";
}

export interface Category {
  id: string;
  name: string;
}

export interface Question {
  id: string;
  type: "true_false" | "short_answer";
  question: string;
  answer: string;
  score: number;
  explanation: string;
  categoryId: string;
  images: string;
  createdAt: number;
  textAlign?: "left" | "center" | "right";
  answerAlign?: "left" | "center" | "right";
  explanationAlign?: "left" | "center" | "right";
  tags?: string;
  options?: string;
}

export interface Exam {
  id: string;
  name: string;
  timeLimit: number;
  questionIds: string;
  questionScores?: string;
  createdAt: number;
}

export interface Result {
  id: string;
  examId: string;
  userId: string;
  username: string;
  answers: string;
  submittedAt: number;
}

export interface Completion {
  userId: string;
  examId: string;
}

export interface ReexamRequest {
  id: string;
  userId: string;
  username: string;
  examId: string;
  examName: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export interface ReexamApproved {
  userId: string;
  examId: string;
}

export interface ExamRequest {
  id: string;
  userId: string;
  username: string;
  examId: string;
  examName: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export interface ExamApproved {
  userId: string;
  examId: string;
}

export interface Grading {
  resultId: string;
  perQuestionScores: string;
  perQuestionFeedback: string;
  finalScore: number;
  gradedBy: string;
  gradedAt: number;
}

export interface JwtPayload {
  username: string;
  role: "admin" | "user";
  sessionVersion: number;
}

export interface SyncData {
  accounts: Account[];
  categories: Category[];
  questions: Question[];
  exams: Exam[];
  results: Result[];
  completions: Completion[];
  reexam_requests: ReexamRequest[];
  reexam_approved: ReexamApproved[];
  exam_requests: ExamRequest[];
  exam_approved: ExamApproved[];
  gradings: Grading[];
}
