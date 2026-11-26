import { mount } from "./controller";
import { send, type ReviewMode } from "./protocol";
import { pageIdentity, type FeedbackItem } from "@app-feedback/shared";
const scope = globalThis as typeof globalThis & {
  __appFeedbackCleanup?: () => void;
  __appFeedbackCommand?: { pageUrl: string; mode: ReviewMode };
  __appFeedbackListener?: (
    message: { type: string },
    sender: chrome.runtime.MessageSender,
  ) => void;
};
const command = scope.__appFeedbackCommand;
delete scope.__appFeedbackCommand;
// A navigation between executeScript calls must not mount UI on another route.
const current = pageIdentity(location.href);
if (command && command.pageUrl === `${current.origin}${current.path}`) {
  scope.__appFeedbackCleanup?.();
  if (scope.__appFeedbackListener)
    chrome.runtime.onMessage.removeListener(scope.__appFeedbackListener);
  scope.__appFeedbackCleanup = mount(
    {
      list: (pageUrl) =>
        send<{ items: FeedbackItem[] }>({ type: "list", pageUrl }),
      post: (input) => send({ type: "post", input }),
      stop: () => send({ type: "disable" }),
    },
    { mode: command.mode },
  );
  scope.__appFeedbackListener = (message, sender) => {
    if (sender.id === chrome.runtime.id && message.type === "hide-review")
      scope.__appFeedbackCleanup?.();
  };
  chrome.runtime.onMessage.addListener(scope.__appFeedbackListener);
}
