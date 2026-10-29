export function ShieldIcon(props: { width?: number; height?: number; className?: string; }) {
    return (
        <svg width={props.width ?? 20} height={props.height ?? 20} viewBox="0 0 24 24" className={props.className} aria-hidden="true">
            <path
                fill="currentColor"
                d="M12 2 4 5v6c0 5.25 3.4 10.15 8 11.4 4.6-1.25 8-6.15 8-11.4V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.6-4.6 1.4 1.4-6 6Z"
            />
        </svg>
    );
}
