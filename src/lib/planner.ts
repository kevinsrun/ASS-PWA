import { Todo } from "./types";

export function suggestTaskOrder(todos: Todo[]): Todo[] {
  const incomplete = todos.filter(t => !t.done);
  return incomplete;
}