export class ChatViewportController {
    public prepareContainer(
        messagesContainer: HTMLElement | null,
        chatContainer: HTMLElement | null,
    ): void {
        if (messagesContainer === null || chatContainer === null) {
            return;
        }

        if (!messagesContainer.classList.contains('has-messages')) {
            messagesContainer.classList.add('has-messages');
            chatContainer.classList.add('has-messages');
        }
    }

    public clear(messagesContainer: HTMLElement | null, chatContainer: HTMLElement | null): void {
        if (messagesContainer !== null) {
            messagesContainer.innerHTML = '';
            messagesContainer.classList.remove('has-messages');
            messagesContainer.style.display = '';
        }

        chatContainer?.classList.remove('has-messages');
    }

    public scrollToBottom(messagesContainer: HTMLElement | null, sticky = false): void {
        if (messagesContainer === null) {
            return;
        }

        if (sticky && !this.isNearBottom(messagesContainer)) {
            return;
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    public isNearBottom(messagesContainer: HTMLElement | null): boolean {
        if (messagesContainer === null) {
            return false;
        }

        const threshold = 150;
        return (
            messagesContainer.scrollHeight -
                messagesContainer.scrollTop -
                messagesContainer.clientHeight <
            threshold
        );
    }
}
