/**
 * The decorative backdrop shared by every visitor screen (name, connecting,
 * surveys, the call itself and the closing survey), so moving from one to the
 * next never changes the sky. `room` is the call: the sky fades in with the
 * assistant's opening and stays clear of stars behind the caption.
 */
export function NightSky({ room = false }) {
    return (
        <div className={`night-sky absolute inset-0 ${room ? 'night-sky--room' : ''}`} aria-hidden="true">
            <div className="night-sky__aurora absolute inset-0" />
            <div className="night-sky__stars absolute inset-0" />
        </div>
    );
}
