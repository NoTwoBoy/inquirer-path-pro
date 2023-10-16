import runAsync from "run-async";
import BasePrompt from "inquirer/lib/prompts/base";
import Choices from "inquirer/lib/objects/choices";

import PathAutocomplete from "./PathAutocomplete";
import PathPromptRenderer from "./PathPromptRenderer";
import { Question } from "inquirer";

const TAB_KEY = "tab";
const ENTER_KEY = "return";
const ESCAPE_KEY = "escape";

type PathAnswers<M extends boolean, D extends any = string> = M extends true
  ? string[]
  : D;
type PathAnswersObj<M extends boolean> = { [n: string]: PathAnswers<M> };
interface PathQuestion<M extends boolean> extends Question<PathAnswersObj<M>> {
  name: string;
  message: string;
  default: PathAnswers<M>;
  cwd: string;
  multi: boolean;
  choices: Choices;
  directoryOnly: boolean;
  validate: (
    path: string,
    answers?: PathAnswersObj<M>,
    paths?: PathAnswers<M, null>
  ) => boolean | string | Promise<boolean | string>;
  filter: (path: PathAnswers<M>) => any;
  when: (answers?: PathAnswersObj<M>) => boolean;
  [k: string]: any;
}
declare type KeyPressEvent$Value = string;
declare type KeyPressEvent$Key = {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

/**
 * An Inquirer prompt for a one or more file system path. It supports autocompletion
 * similarly to zshell.
 * @param {object} question
 * @param {string} question.name The name to use when storing the answer in the answers hash.
 * @param {string} question.message The message to display when prompting the user for a path.
 * @param {string} [question.cwd=process.cwd()] The default working directory from which
 * relative paths are resolved. It is also the default value.
 * @param {string} [question.default=process.cwd()] Same as question.cwd
 * @param {boolean} [question.multi=false] If set to true, the user can enter multiple paths
 * @param {boolean} [question.directoryOnly=false] If set to true, the user can only enter paths to
 * directories
 * @param {function} [question.validate]  Receive the user input and should return true if the value
 * is valid or an error message (String) otherwise. If false is returned, a default error message is
 * provided. If question.multi is true, it is called for each path entered by the user.
 * @param {function} [question.validateMulti] If question.multi is set to true, it is called once
 * the question has been answered. It should return true if the value is valid or an error message
 * (String) otherwise.
 * @param {function} [question.filter] Receive the user input and return the filtered value to be
 * used inside the program. The value returned will be added to the Answers hash.
 * @param {function} [question.when] Receive the current user answers hash and should return true
 * or false depending on whether or not this question should be asked. The value can also be a
 * simple boolean..
 * @param rl An instance of readline.Interface
 * @param answers The answers provided by the user to other prompts
 */
export default class PathPrompt<M extends boolean = false> extends BasePrompt {
  opt: PathQuestion<M>;
  rl: InquirerReadLine;
  listeners: {
    SIGINT: Function[];
    [k: string]: Function[];
  };
  bindedOnExit: () => void;
  bindedOnKeyPress: (
    value: KeyPressEvent$Value,
    key: KeyPressEvent$Key
  ) => void;
  autocomplete: PathAutocomplete;
  renderer: PathPromptRenderer;
  paths: string[];
  answerCallback: (value: string | string[]) => void;
  isTryingExit: boolean;

  constructor(
    question: Partial<PathQuestion<M>> & {
      name: string;
      message: string;
    },
    rl: InquirerReadLine,
    answers: {}
  ) {
    super(question, rl, answers);

    const multi = question.multi ?? false;
    const cwd = question.cwd || process.cwd();
    const defaultPathAnswer =
      question.default || ((multi ? [cwd] : cwd) as PathAnswers<M>);

    this.opt = {
      ...question,
      cwd,
      default: defaultPathAnswer,
      multi,
      directoryOnly: question.directoryOnly ?? false,
      choices: question.choices || ([] as unknown as Choices),
      validate: question.validate || ((_p: string | string[]) => true),
      filter: question.filter || ((_p: PathAnswers<M>) => _p),
      when: question.when || (() => true),
    };
    this.rl = rl;

    // bind event listeners
    this.bindedOnExit = this.onExit.bind(this);
    this.bindedOnKeyPress = this.onKeyPress.bind(this);

    this.paths = [];
    this.autocomplete = new PathAutocomplete(
      cwd,
      this.getDefaultPath(),
      question.directoryOnly
    );
    this.renderer = new PathPromptRenderer(
      this.rl,
      this.screen,
      this.autocomplete,
      this.opt.message
    );
    this.answerCallback = () => {};
    this.isTryingExit = false;
    this.listeners = {
      SIGINT: [],
    };
  }

  getDefaultPath(): string {
    return Array.isArray(this.opt.default)
      ? this.opt.default[this.paths.length]
      : this.opt.default;
  }

  /**
   * Runs the path prompt.
   * @param callback - Called when the prompt has been answered successfully
   * @returns
   */
  _run(callback: (value: string | string[]) => void): PathPrompt<M> {
    this.answerCallback = callback;
    // backup event listeners so we can rebind them later
    this.listeners.SIGINT = this.rl.listeners("SIGINT");
    this.rl.removeAllListeners("SIGINT");

    this.rl.addListener("SIGINT", this.bindedOnExit);
    this.rl.input.addListener("keypress", this.bindedOnKeyPress);
    this.renderer.render();
    return this;
  }

  /**
   * Handle the keyPress events and update the @{link PathAutocomplete} state
   * accordingly.
   * @param value The string value of the keyboard entry
   * @param key Information about the name of the key and whether other special
   * keys were pressed at the same time.
   */
  onKeyPress(value: KeyPressEvent$Value, key: KeyPressEvent$Key) {
    if (key && key.ctrl) {
      return;
    }
    const keyName = key ? key.name : value;
    this.isTryingExit = false;
    switch (keyName) {
      case TAB_KEY:
        try {
          this.autocomplete.nextMatch(!key.shift);
          this.renderer.render();
        } catch (err) {
          this.renderer.renderError((err as Error).message);
        }
        break;
      case ENTER_KEY:
        this.onEnterPressed();
        break;
      case ESCAPE_KEY:
        this.onEscapePressed();
        break;
      default:
        this.autocomplete.setPath(this.rl.line);
        this.renderer.render();
        break;
    }
  }

  /**
   * Select the current match or submit the answer
   */
  onEnterPressed() {
    if (this.autocomplete.getMatchIndex() !== -1) {
      this.autocomplete.selectMatch();
      this.renderer.render();
    } else {
      this.submitAnswer();
    }
  }

  /**
   * Cancel matching or submit the answer for a multi path prompt
   */
  onEscapePressed() {
    if (this.autocomplete.getMatchIndex() !== -1) {
      this.autocomplete.cancelMatch();
      this.renderer.render();
    } else if (this.opt.multi) {
      this.submitAnswer(true);
    }
  }

  /**
   * Event handler for cancel events (SIGINT). If the user is currently selecting a path,
   * it causes the selection to be cancelled. If the prompt is a multi path prompt, it
   * causes the question to be done. If none of these conditions are met, the event handlers
   * are cleaned up and the regular SIGINT handlers are involved
   */
  onExit(...args: any[]) {
    // Cancel the path selection
    if (this.autocomplete.getMatchIndex() !== -1) {
      this.autocomplete.cancelMatch();
      this.renderer.render();
    } else if (this.opt.multi && !this.isTryingExit) {
      this.submitAnswer(true);
      this.isTryingExit = true;
    } else {
      // Exit out
      this.restoreEventHandlers();
      // Call the restored SIGINT callbacks manually
      this.rl.listeners("SIGINT").forEach((listener) => listener(...args));
    }
  }

  /**
   * Validate the answer and kill the prompt if it's either a single path
   * prompt or a multiple path prompt and submitMulti is set to true.
   * @param submitMulti If set to true, submit all answers
   */
  submitAnswer(submitMulti: boolean = false) {
    const path = this.autocomplete.getPath().getAbsolutePath();
    const paths = (this.opt.multi ? this.paths : null) as PathAnswers<M, null>;
    const answer = (
      this.opt.multi && submitMulti ? paths : path
    ) as PathAnswers<M>;

    const validate = runAsync(this.opt.validate);
    const filter = runAsync(this.opt.filter);

    let promiseChain = (
      submitMulti
        ? Promise.resolve(answer)
        : validate(path, this.answers, paths).then((isValid) => {
            if (isValid !== true) {
              throw isValid;
            }
            return answer;
          })
    ).then(filter);

    if (!this.opt.multi) {
      // Render the final path
      promiseChain = promiseChain.then((finalAnswer) => {
        this.renderer.render(finalAnswer);
        return finalAnswer;
      });
    } else if (this.opt.multi && !submitMulti) {
      // For a new path entry, render a fresh prompt
      promiseChain = promiseChain.then((finalAnswer) => {
        // Update the array keeping track of the answers
        this.paths.push(finalAnswer);
        // Create a new autocomplete instance for the new prompt
        this.autocomplete = new PathAutocomplete(
          this.autocomplete.getWorkingDirectory().getAbsolutePath(),
          this.getDefaultPath(),
          this.autocomplete.isDirectoryOnly()
        );
        this.renderer.renderNewPrompt(finalAnswer, this.autocomplete);
        return finalAnswer;
      });
    }
    // Kill the prompt
    if (!this.opt.multi || submitMulti) {
      promiseChain = promiseChain.then((finalAnswer) => {
        this.status = "answered";
        this.renderer.kill();
        this.restoreEventHandlers();
        this.answerCallback(finalAnswer);
      });
    }
    promiseChain.catch((error) => this.renderer.renderError(error));
  }

  /**
   * Unregister the instance's event handlers and register global event
   * handlers ones that were temporarily removed.
   */
  restoreEventHandlers() {
    this.rl.removeListener("SIGINT", this.bindedOnExit);
    this.rl.input.removeListener("keypress", this.bindedOnKeyPress);
    Object.keys(this.listeners).forEach((eventName) => {
      this.listeners[eventName].forEach((listener) => {
        this.rl.addListener(eventName, listener as (...args: any[]) => void);
      });
    });
  }
}
