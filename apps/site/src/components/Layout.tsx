import { useState, type ReactNode } from "react";
import { Link } from "../router";

const GITHUB_URL = "https://github.com/karimsa/mdxserve";

type Theme = "light" | "dark";

function readTheme(): Theme {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(readTheme);
	const next: Theme = theme === "dark" ? "light" : "dark";
	return (
		<button
			type="button"
			className="icon-button"
			aria-label={`Switch to ${next} theme`}
			title={`Switch to ${next} theme`}
			onClick={() => {
				document.documentElement.dataset.theme = next;
				try {
					localStorage.setItem("mdxserve-site-theme", next);
				} catch {
					// Storage can be disabled; the choice then lasts for this page view only.
				}
				setTheme(next);
			}}
		>
			{theme === "dark" ? (
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
				</svg>
			) : (
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
				</svg>
			)}
		</button>
	);
}

export function Wordmark() {
	return (
		<span className="wordmark">
			mdx<span className="wordmark-accent">serve</span>
		</span>
	);
}

export function Layout({ children }: { children: ReactNode }) {
	return (
		<div className="page">
			<header className="topbar">
				<div className="topbar-inner">
					<Link to="/" className="brand" aria-label="mdxserve home">
						<Wordmark />
					</Link>
					<nav className="topnav" aria-label="Site">
						<Link to="/tour">Tour</Link>
						<Link to="/get-started">Get started</Link>
						<a href={GITHUB_URL}>GitHub</a>
					</nav>
					<ThemeToggle />
				</div>
			</header>
			<main className="content">{children}</main>
			<footer className="footer">
				<div className="footer-inner">
					<Wordmark />
					<span>
						Open source under the MIT license. <a href={GITHUB_URL}>Source on GitHub</a>.
					</span>
				</div>
			</footer>
		</div>
	);
}
