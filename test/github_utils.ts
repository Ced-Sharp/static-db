import { basename } from "node:path";

export class GitHubFile {
  static APIUrl: string = "https://api.github.com";
  static RepoOwner: string = "Ced-Sharp";
  static RepoName: string = "datum-test-project";
  static RepoBranch: string = "master";

  name: string;

  static New(path: string, content: string = "", sha = "") {
    return new GitHubFile(path, content, sha).toJson();
  }

  constructor(
    public path: string,
    public content = "",
    public sha = "",
  ) {
    this.name = basename(path);
  }

  get type() {
    return this.name.includes(".") ? "file" : "directory";
  }

  get url() {
    return (
      [
        GitHubFile.APIUrl,
        "repos",
        GitHubFile.RepoOwner,
        GitHubFile.RepoName,
        "contents",
        this.path,
      ].join("/") + `?ref=${GitHubFile.RepoBranch}`
    );
  }

  get html_url() {
    return [
      "https://github.com",
      GitHubFile.RepoOwner,
      GitHubFile.RepoName,
      "blob",
      GitHubFile.RepoBranch,
      this.path,
    ].join("/");
  }

  get git_url() {
    return "<TODO: Not implemented>";
  }

  get download_url() {
    return (
      [
        "https://raw.githubusercontent.com",
        GitHubFile.RepoOwner,
        GitHubFile.RepoName,
        GitHubFile.RepoBranch,
        this.path,
      ].join("/") + "?token=<TODO: not implemented>"
    );
  }

  get _links() {
    return {
      self: this.url,
      git: this.git_url,
      html: this.html_url,
    };
  }

  withJson(data: unknown) {
    this.content = JSON.stringify(data);
    return this;
  }

  toJson() {
    return {
      path: this.path,
      name: this.name,
      type: this.type,
      url: this.url,
      git_url: this.git_url,
      html_url: this.html_url,
      download_url: this.download_url,
      content: btoa(this.content),
      sha: this.sha,
      _links: this._links,
    };
  }
}

export class GitHubFileSystem extends GitHubFile {
  constructor(
    path: string,
    public children: GitHubFileSystem[] = [],
  ) {
    super(path);
  }

  cd(name: string) {
    if (this.type === "file") {
      throw new Error("Cannot cd into a file!");
    }

    const item = this.children.find((f) => f.name === name);

    if (!item) {
      throw new Error(`Cannot cd into "${name}": not found`);
    }

    return item;
  }

  files() {
    if (this.type === "file") {
      throw new Error("Cannot get files of a file!");
    }

    return this.children;
  }

  toTreeView() {
    const icon = this.type === "file" ? "📄" : "📂";
    let tree = `${icon} ${this.name}`;

    for (let i = 0; i < this.children.length; i++) {
      const isLast = i === this.children.length - 1;
      const symbol = (isLast ? "└" : "├") + "──";
      const subTree = this.children[i].toTreeView();
      const indentedSubTree = subTree
        .split("\n")
        .map((line, num) =>
          num === 0 ? `${symbol} ${line}` : (isLast ? " " : "│") + `   ${line}`,
        )
        .join("\n");
      tree += "\n" + indentedSubTree;
    }

    return tree;
  }
}
