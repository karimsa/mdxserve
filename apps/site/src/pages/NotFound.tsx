import { Link } from "../router";

export function NotFound() {
	return (
		<article className="prose">
			<h1>Page not found</h1>
			<p>There is no page at this address.</p>
			<p>
				<Link to="/">Go to the home page</Link> or <Link to="/get-started">get started</Link>.
			</p>
		</article>
	);
}
