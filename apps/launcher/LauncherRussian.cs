using System.Collections.Generic;

namespace BlacksoulsCommunity
{
    // Fork-owned launcher text; the engine supplies its native Russian controls.
    internal static class LauncherRussian
    {
        private static readonly Dictionary<string, string> Messages = new Dictionary<string, string>
        {
            { "Game folder", "Папка игры" },
            { "Choose game folder", "Выбрать папку игры" },
            { "Language", "Язык" },
            { "Choose how to play", "Выберите режим игры" },
            { "Play on PC\nKeyboard & mouse", "Играть на ПК\nКлавиатура и мышь" },
            { "Play in VR\nHeadset & controllers", "Играть в VR\nШлем и контроллеры" },
            { "Play on PC", "Играть на ПК" },
            { "Play in VR", "Играть в VR" },
            { "Launch in VR", "Запустить VR" },
            { "Launch on PC", "Запустить на ПК" },
            { "Before you enter VR", "Перед входом в VR" },
            { "Ready for PC play", "Готово к игре на ПК" },
            { "Connect your headset with Meta Quest Link or SteamVR, then launch. Keep your headset and controllers ready.", "Подключите шлем через Meta Quest Link или SteamVR и запустите игру. Подготовьте шлем и контроллеры." },
            { "Play in a normal game window. A VR headset is optional. Your saves work in both modes.", "Играйте в обычном окне. VR-шлем не требуется. Сохранения работают в обоих режимах." },
            { "Status", "Состояние" },
            { "Launcher details", "Журнал запуска" },
            { "Scroll", "Прокрутка" },
            { "Choose a mode, then launch.", "Выберите режим и запустите игру." },
            { "Choose the BLACK SOULS II folder containing Game.exe.", "Выберите папку BLACK SOULS II, содержащую Game.exe." },
            { "Selected", "Выбрано" },
            { "Advanced options", "Дополнительные параметры" },
            { "Details", "Подробности" },
            { "Expanded", "Развёрнуто" },
            { "Collapsed", "Свёрнуто" },
            { "Minimize window", "Свернуть окно" },
            { "Restore window", "Восстановить окно" },
            { "Maximize window", "Развернуть окно" },
            { "Close launcher", "Закрыть программу" },
            { "Check for updates", "Проверить обновления" },
            { "Download update", "Скачать обновление" },
            { "Downloading", "Загрузка" },
            { "Checking…", "Проверка…" },
            { "You're up to date.", "Установлена последняя версия." },
            { "An update is available: ", "Доступно обновление: " },
            { "Retry update check", "Повторить проверку" },
            { "The update check couldn't be completed. Please restart the launcher and try again.", "Не удалось завершить проверку обновлений. Перезапустите программу и повторите попытку." },
            { "Update downloaded and verified.", "Обновление загружено и проверено." },
            { "The update is ready. Close the game and open setup now? Your saves will be kept.", "Обновление готово. Закрыть игру и запустить установку? Сохранения будут сохранены." },
            { "The update couldn't be downloaded or verified. Please try again.", "Не удалось загрузить или проверить обновление. Повторите попытку." },
            { "GitHub is temporarily limiting update checks. Please try again later.", "GitHub временно ограничивает проверки обновлений. Повторите попытку позже." },
            { "GitHub refused the update check (HTTP 403). Please try again later.", "GitHub отклонил проверку обновлений (HTTP 403). Повторите попытку позже." },
            { "No published update was found for this app. Please try again later.", "Опубликованное обновление не найдено. Повторите попытку позже." },
            { "GitHub's update service is temporarily unavailable. Please try again later.", "Служба обновлений GitHub временно недоступна. Повторите попытку позже." },
            { "The update check timed out. Please try again.", "Время ожидания проверки обновлений истекло. Повторите попытку." },
            { "A secure connection to GitHub couldn't be established. Check your Windows date and network settings.", "Не удалось установить защищённое соединение с GitHub. Проверьте дату Windows и параметры сети." },
            { "The new version's Windows installer isn't ready yet. Please try again later.", "Установщик новой версии для Windows ещё не готов. Повторите попытку позже." },
            { "The update service returned an unreadable response. Please try again later.", "Служба обновлений вернула некорректный ответ. Повторите попытку позже." },
            { "The update service returned HTTP ", "Служба обновлений вернула HTTP " },
            { "Couldn't connect to GitHub to check for updates. Check your connection and try again.", "Не удалось подключиться к GitHub для проверки обновлений. Проверьте соединение и повторите попытку." },
            { "Try after ", "Повторите после " },
            { "Steam achievements connected.", "Достижения Steam подключены." },
            { "Steam achievements unavailable. Sign in to Steam and make sure you own the game.", "Достижения Steam недоступны. Войдите в Steam и убедитесь, что игра есть в вашей библиотеке." },
        };

        internal static string Text(string english)
        {
            string translated;
            return Messages.TryGetValue(english, out translated) ? translated : english;
        }
    }
}
