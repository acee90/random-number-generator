export default function RoomCandidateAuthor({ name }: { name: string }) {
	return (
		<span className="room-simple-state-badge room-candidate-author">
			<span className="sr-only">등록자 </span>
			{name}
		</span>
	);
}
