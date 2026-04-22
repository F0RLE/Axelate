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

        if (sticky) {
            const threshold = 150;
            const isAtBottom =
                messagesContainer.scrollHeight -
                    messagesContainer.scrollTop -
                    messagesContainer.clientHeight <
                threshold;

            if (!isAtBottom) {
                return;
            }
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}
